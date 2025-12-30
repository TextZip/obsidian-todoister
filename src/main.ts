import { type CurrentUser, TodoistApi } from "@doist/todoist-api-typescript";
import type {
	MutationObserver,
	QueryClient,
	QueryObserver,
	QueryObserverResult,
} from "@tanstack/query-core";
import type { Persister } from "@tanstack/query-persist-client-core";
import {
	type Editor,
	type EditorPosition,
	MarkdownView,
	Notice,
	Plugin,
	TFile,
} from "obsidian"; // NOT type-only
import { obsidianFetchAdapter } from "./lib/obsidian-fetch-adapter.ts";
import { type ParseResults, parseContent } from "./lib/parse-content.ts";
import { createQueryClient } from "./lib/query/create-query-client.ts";
import { mutationAddTask } from "./lib/query/mutation-add-task.ts";
import { mutationSetCheckedTask } from "./lib/query/mutation-set-checked-task.ts";
import { mutationUpdateTask } from "./lib/query/mutation-update-task.ts";
import { queryProjectList } from "./lib/query/query-project-list.ts";
import { queryTask } from "./lib/query/query-task.ts";
import { queryUserInfo } from "./lib/query/query-user-info.ts";
import { TodoisterSettingTab } from "./lib/settings-tab.ts";
import { SyncIndicator } from "./lib/sync-indicator.ts";
import { isObsidianId } from "./lib/task/is-obsidian-id.ts";
import type { ObsidianTask } from "./lib/task/obsidian-task.ts";
import { obsidianTaskStringify } from "./lib/task/obsidian-task-stringify.ts";
import { tasksEquals } from "./lib/task/tasks-equals.ts";
import { todoisterIdPlugin } from "./lib/todoister-id-plugin.ts";

interface PluginData {
	oauthAccessToken?: string;
	todoistProjectId?: string;
	queryCache?: string;
}

interface ActiveFileCacheItemTodoist {
	/**
	 * Timestamp (ms) of the last time we pushed an edit from Obsidian -> Todoist
	 * Used as an echo-guard to ignore the immediately-following Todoist refetch.
	 */
	lastLocalEditAt?: number;

	query: Pick<
		QueryObserver<ObsidianTask | { deleted: true; id: string }>,
		"subscribe" | "destroy" | "getCurrentResult"
	>;
	updateContent: Pick<
		MutationObserver<unknown, Error, { content: string }>,
		"mutate"
	>;
	toggleCheck: Pick<
		MutationObserver<unknown, Error, { checked: boolean }>,
		"mutate"
	>;
}

interface ActiveFileCacheItemObsidian {
	/**
	 * Timestamp (ms) of the last time we pushed an edit from Obsidian -> Todoist
	 * (mostly irrelevant for "obsidian-id" placeholder entries, but kept for symmetry)
	 */
	lastLocalEditAt?: number;

	add: Pick<MutationObserver<unknown, Error, { content: string }>, "mutate">;
}

type ActiveFileCacheItem =
	| ActiveFileCacheItemTodoist
	| ActiveFileCacheItemObsidian;

function isObsidianCacheItem(
	item: ActiveFileCacheItem,
): item is ActiveFileCacheItemObsidian {
	return "add" in item;
}

export default class TodoisterPlugin extends Plugin {
	#data!: PluginData;
	#processContentChangeTimeout?: ReturnType<typeof setTimeout>;
	#processFileChangeTimeout?: ReturnType<typeof setTimeout>;
	#selfWritingPaths = new Set<string>();
	#todoistClient: TodoistApi | undefined;
	#queryClient!: QueryClient;
	#unsubscribePersist?: VoidFunction;
	#activeFileCache = new Map<string, ActiveFileCacheItem>();
	#syncIndicator?: SyncIndicator;
	#getTodoistClient = (): TodoistApi => {
		const client = this.#todoistClient;

		if (!client) {
			throw new Error("Todoist client is not initialized");
		}

		return client;
	};
	oauthState?: string;
	userInfoObserver?: Pick<QueryObserver<CurrentUser>, "subscribe" | "destroy">;
	projectListObserver?: Pick<
		QueryObserver<{ id: string; name: string }[]>,
		"subscribe" | "destroy"
	>;
	oauthCallbackResolver?: (code: string) => void;
	oauthCallbackRejector?: (error: Error) => void;

	get oauthAccessToken(): string | undefined {
		return this.#data.oauthAccessToken;
	}

	set oauthAccessToken(value: string | undefined) {
		this.#data.oauthAccessToken = value;

		this.#initClient();
		this.#saveData();
	}

	get todoistProjectId(): string {
		return this.#data.todoistProjectId ?? "";
	}

	set todoistProjectId(value: string) {
		this.#data.todoistProjectId = value === "" ? undefined : value;

		this.#saveData();
	}

	async onload() {
		await this.#loadData();
		await this.#initQueryClient();
		this.#initClient();

		this.userInfoObserver = queryUserInfo({
			queryClient: this.#queryClient,
			todoistApi: this.#getTodoistClient,
		});
		this.projectListObserver = queryProjectList({
			queryClient: this.#queryClient,
			todoistApi: this.#getTodoistClient,
		});

		this.addSettingTab(new TodoisterSettingTab(this.app, this));

		this.registerEditorExtension(todoisterIdPlugin);

		this.addCommand({
			id: "enable-todoist-sync",
			name: "Enable Todoist sync for current file",
			checkCallback: this.#onEnableSync,
		});

		this.addCommand({
			id: "disable-todoist-sync",
			name: "Disable Todoist sync for current file",
			checkCallback: this.#onDisableSync,
		});

		this.addCommand({
			id: "refresh-todoist-cache",
			name: "Resync current file with Todoist",
			callback: this.#invalidateAll,
		});

		this.registerObsidianProtocolHandler("todoister-oauth", this.#onOauth);

		this.registerEvent(this.app.workspace.on("file-open", this.#onFileOpen));
		// this.registerEvent(this.app.vault.on("modify", (file) => this.#onVaultModify(file)));
		this.registerEvent(this.app.vault.on("modify", this.#onVaultModify));
		// this.registerDomEvent(this.app.workspace.containerEl,"click",this.#onPreviewCheckboxClick,);

		this.registerEvent(
			this.app.workspace.on("layout-change", this.#onLayoutChange),
		);

		this.registerEvent(
			this.app.workspace.on("editor-change", this.#onEditorChange),
		);

		this.registerDomEvent(window, "focus", this.#invalidateStale);
		this.registerDomEvent(window, "online", this.#invalidateStale);

		this.#syncIndicator = new SyncIndicator(
			this.#queryClient,
			this.addStatusBarItem(),
		);

		this.#onLayoutChange();
	}

	onunload() {
		this.#clearActiveFileCache();
		this.#unsubscribePersist?.();
		this.#syncIndicator?.destroy();
		this.userInfoObserver?.destroy();
		this.projectListObserver?.destroy();
		this.#queryClient?.clear();
	}

	#saveData() {
		return this.saveData(this.#data);
	}

	async #loadData() {
		try {
			this.#data = (await this.loadData()) || {};
		} catch {
			this.#data = {};
		}
	}

	#initClient() {
		if (this.#data.oauthAccessToken) {
			this.#todoistClient = new TodoistApi(this.#data.oauthAccessToken, {
				customFetch: obsidianFetchAdapter,
			});
		} else {
			this.#todoistClient = undefined;
		}
	}

	async #initQueryClient() {
		const persister: Persister = {
			persistClient: async (client) => {
				this.#data.queryCache = JSON.stringify(client);
				await this.saveData(this.#data);
			},
			restoreClient: async () => {
				if (!this.#data.queryCache) return undefined;
				try {
					return JSON.parse(this.#data.queryCache);
				} catch {
					return undefined;
				}
			},
			removeClient: async () => {
				this.#data.queryCache = undefined;
				await this.saveData(this.#data);
			},
		};

		const { queryClient, unsubscribe } = await createQueryClient({
			persister,
		});

		this.#queryClient = queryClient;
		this.#unsubscribePersist = unsubscribe;
	}

	#getActiveMarkdownView(): MarkdownView | null {
		return this.app.workspace.getActiveViewOfType(MarkdownView);
	}

	#getActiveMode(): "source" | "preview" | "unknown" {
		const view = this.#getActiveMarkdownView();
		if (!view) return "unknown";

		// MarkdownView supports getMode(): "source" | "preview"
		const mode = view.getMode?.();
		if (mode === "source" || mode === "preview") return mode;

		// fallback for older/alt builds
		const t = (view as any).currentMode?.type;
		if (t === "source" || t === "preview") return t;

		return "unknown";
	}

	#isReadingView(): boolean {
		return this.#getActiveMode() === "preview";
	}

	#isEditingView(): boolean {
		return this.#getActiveMode() === "source";
	}

	#onVaultModify = (file: unknown) => {
		const active = this.app.workspace.getActiveFile();
		if (!active) return;

		// IMPORTANT: TFile must be runtime import: `import { TFile } from "obsidian"`
		if (!(file instanceof TFile)) return;

		// only care about active file
		if (file.path !== active.path) return;

		if (!this.#pluginIsEnabled(file)) return;
		if (!this.#checkRequirements()) return;

		// ignore our own writes
		if (this.#selfWritingPaths.has(file.path)) return;

		clearTimeout(this.#processFileChangeTimeout);
		this.#processFileChangeTimeout = setTimeout(() => {
			// parse from disk and push diffs to Todoist
			void this.#handleContentUpdateFromFile(file);
		}, 250);
	};

	async #vaultModifySelf(file: TFile, nextText: string) {
		this.#selfWritingPaths.add(file.path);
		try {
			await this.app.vault.modify(file, nextText);
		} finally {
			// small delay to let Obsidian finish emitting modify/layout events
			setTimeout(() => this.#selfWritingPaths.delete(file.path), 500);
		}
	}

	#checkRequirements() {
		if (!this.#data.oauthAccessToken) {
			new Notice("Please connect your Todoist account in settings");
			return false;
		}

		if (!this.#data.todoistProjectId) {
			new Notice("Please configure your project ID in settings");
			return false;
		}

		return true;
	}

	#pluginIsEnabled(file: TFile | null): file is TFile {
		if (!file) return false;

		return (
			this.app.metadataCache.getFileCache(file)?.frontmatter?.todoister === true
		);
	}

	async #toggleTodoistSync(file: TFile, enable: boolean) {
		await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
			frontmatter.todoister = enable;
		});

		if (enable) {
			this.#onLayoutChange();
		} else {
			this.#clearActiveFileCache();
		}
	}

	#onEnableSync = (checking: boolean) => {
		const file = this.app.workspace.getActiveFile();
		if (!file || this.#pluginIsEnabled(file)) return false;

		if (!checking) {
			this.#toggleTodoistSync(file, true);
		}
		return true;
	};

	#onDisableSync = (checking: boolean) => {
		const file = this.app.workspace.getActiveFile();
		if (!file || !this.#pluginIsEnabled(file)) return false;

		if (!checking) {
			this.#toggleTodoistSync(file, false);
		}
		return true;
	};

	#onOauth = ({ code, state, error }: Record<string, string>) => {
		if (error) {
			this.oauthCallbackRejector?.(
				new Error(`OAuth error: ${error}`, { cause: error }),
			);
			return;
		}

		if (!code) {
			this.oauthCallbackRejector?.(new Error("Missing oauth code"));
			return;
		}

		if (!state) {
			this.oauthCallbackRejector?.(new Error("Missing oauth state"));
			return;
		}

		if (state !== this.oauthState) {
			this.oauthCallbackRejector?.(new Error("Oauth state mismatch"));
			this.oauthState = undefined;
			return;
		}

		this.oauthCallbackResolver?.(code);
	};

	#clearActiveFileCache(): void {
		for (const cacheEntry of this.#activeFileCache.values()) {
			if (!isObsidianCacheItem(cacheEntry)) {
				cacheEntry.query.destroy();
			}
		}

		this.#activeFileCache.clear();
	}

	#updateActiveFileCache(parseResults: ParseResults, allowPush = true) {
		const existedTaskIds = new Set<string>();

		for (const { task } of parseResults) {
			existedTaskIds.add(task.id);

			const cacheItem = this.#activeFileCache.get(task.id);

			if (cacheItem) {
				// IMPORTANT:
				// Do NOT set any "updatedAt" flag just because a task exists in the file.
				// That blocks inbound Todoist updates forever (especially in Reading view).
				if (!isObsidianCacheItem(cacheItem)) {
					const { data: todoistTask } = cacheItem.query.getCurrentResult();

					if (!todoistTask || "deleted" in todoistTask) continue;

					if (allowPush && !tasksEquals(todoistTask, task)) {
						let willMutate = false;

						if (todoistTask.checked !== task.checked) willMutate = true;
						if (todoistTask.content !== task.content) willMutate = true;

						if (willMutate) cacheItem.lastLocalEditAt = Date.now();

						if (todoistTask.checked !== task.checked) {
							cacheItem.toggleCheck.mutate({ checked: task.checked });
						}

						if (todoistTask.content !== task.content) {
							cacheItem.updateContent.mutate({ content: task.content });
						}
					}
				}
			} else {
				this.#addToActiveFileCache(task.id, this.#createCacheEntry(task));
			}
		}

		for (const [taskId] of this.#activeFileCache) {
			if (!existedTaskIds.has(taskId)) {
				this.#deleteFromActiveFileCache(taskId);
			}
		}
	}

	#addToActiveFileCache(id: string, item: ActiveFileCacheItem) {
		this.#activeFileCache.set(id, item);
	}

	#deleteFromActiveFileCache(id: string) {
		const cacheItem = this.#activeFileCache.get(id);

		if (!cacheItem) return;

		if (!isObsidianCacheItem(cacheItem)) {
			cacheItem.query.destroy();
		}

		this.#activeFileCache.delete(id);
	}

	#createCacheEntry(task: ObsidianTask): ActiveFileCacheItem {
		if (isObsidianId(task.id)) {
			return this.#createObsidianCacheEntry(task);
		} else {
			return this.#createTodoistCacheEntry(task);
		}
	}

	async #handleContentUpdateFromFile(file: TFile) {
		const content = await this.app.vault.read(file);
		const parseResults = parseContent(content);

		// If there are "new" tasks (no tid), we *can* still write them back in Reading view.
		// We'll do it by line replacement (preserving prefixes like "> " using from.ch).
		const lines = content.split("\n");
		let changed = false;

		for (const { task, isNew, lineNumber, from } of parseResults) {
			if (!isNew) continue;

			const original = lines[lineNumber] ?? "";
			const prefix = original.slice(0, from.ch);
			const next = prefix + obsidianTaskStringify(task);

			if (next !== original) {
				lines[lineNumber] = next;
				changed = true;
			}
		}

		if (changed) {
			await this.#vaultModifySelf(file, lines.join("\n"));
			// Re-parse after writing IDs so cache sees correct IDs
			const reparsed = parseContent(lines.join("\n"));
			this.#updateActiveFileCache(reparsed);
			return;
		}

		this.#updateActiveFileCache(parseResults, false);
	}

	#createTodoistCacheEntry(task: ObsidianTask): ActiveFileCacheItemTodoist {
		const cacheEntry: ActiveFileCacheItemTodoist = {
			query: queryTask({
				queryClient: this.#queryClient,
				taskId: task.id,
				todoistApi: this.#getTodoistClient,
				initialData: task,
			}),
			updateContent: mutationUpdateTask({
				queryClient: this.#queryClient,
				taskId: task.id,
				todoistApi: this.#getTodoistClient,
			}),
			toggleCheck: mutationSetCheckedTask({
				queryClient: this.#queryClient,
				taskId: task.id,
				todoistApi: this.#getTodoistClient,
			}),
		};
		console.log("creating query observer for", task.id);
		cacheEntry.query.subscribe(this.#onQueryUpdate);

		return cacheEntry;
	}

	#createObsidianCacheEntry({
		id,
		...task
	}: ObsidianTask): ActiveFileCacheItemObsidian {
		const add = mutationAddTask({
			queryClient: this.#queryClient,
			taskId: id,
			todoistApi: this.#getTodoistClient,
			projectId: this.#data.todoistProjectId!,
		});

		add.mutate(task).then((todoistTask) => {
			const file = this.app.workspace.getActiveFile();
			const editor = this.app.workspace.activeEditor?.editor;

			if (!this.#pluginIsEnabled(file)) return;
			if (!editor) return;

			if (editor.getValue().includes(id)) {
				let offset = editor.getValue().indexOf(id);

				while (offset !== -1) {
					const from = editor.offsetToPos(offset);
					const to = editor.offsetToPos(offset + id.length);

					this.#replaceRange(editor, todoistTask.id, from, to);

					offset = editor.getValue().indexOf(id);
				}

				this.#addToActiveFileCache(
					todoistTask.id,
					this.#createTodoistCacheEntry(todoistTask),
				);

				this.#handleContentUpdate(); // If task created checked
			}

			this.#deleteFromActiveFileCache(id);
		});

		return {
			add,
		};
	}

	#replaceRange(
		editor: Editor,
		text: string,
		from: EditorPosition,
		to: EditorPosition,
	) {
		const cursorPos = editor.getCursor();
		const isOnEditedLine = cursorPos.line === from.line;

		editor.replaceRange(text, from, to);

		if (isOnEditedLine) {
			editor.setCursor(cursorPos);
		}

		clearTimeout(this.#processContentChangeTimeout);
	}

	#handleContentUpdate = () => {
		const editor = this.app.workspace.activeEditor?.editor;

		if (!editor) return;

		const parseResults = parseContent(editor.getValue());

		for (const { task, from, to } of parseResults.filter(
			({ isNew }) => isNew,
		)) {
			this.#replaceRange(editor, obsidianTaskStringify(task), from, to);
		}

		this.#updateActiveFileCache(parseResults, true);
	};

	#onFileOpen = (file: TFile | null) => {
		if (!this.#checkRequirements() || !this.#pluginIsEnabled(file)) {
			this.#clearActiveFileCache();
		}
	};

	#onLayoutChange = () => {
		const file = this.app.workspace.getActiveFile();
		console.log("[Todoister] mode:", this.#getActiveMode());
		if (!this.#pluginIsEnabled(file)) return;
		if (!this.#checkRequirements()) return;

		if (this.#isReadingView()) {
			// preview / reading view: read+write file directly
			this.#handleContentUpdateFromFile(file);
		} else {
			// source / live preview: update through editor
			this.#handleContentUpdate();
		}
	};

	#onEditorChange = () => {
		// In Reading view, editor-change events can still fire / be noisy,
		// but we don't want to push file->todoist from preview.
		if (!this.#isEditingView()) return;

		clearTimeout(this.#processContentChangeTimeout);

		this.#processContentChangeTimeout = setTimeout(() => {
			if (!this.#pluginIsEnabled(this.app.workspace.getActiveFile())) return;
			if (!this.#checkRequirements()) return;

			this.#processContentChangeTimeout = undefined;
			this.#handleContentUpdate();
		}, 1000);
	};

	#invalidateAll = () => {
		const file = this.app.workspace.getActiveFile();
		if (!this.#pluginIsEnabled(file)) return;

		const editor = this.app.workspace.activeEditor?.editor;
		if (editor) {
			this.#queryClient.invalidateQueries();
		} else if (file) {
			this.#handleContentUpdateFromFile(file).then(() => {
				this.#queryClient.invalidateQueries();
				this.#queryClient.refetchQueries();
			});
		}
	};

	#invalidateStale = () => {
		if (!this.#pluginIsEnabled(this.app.workspace.getActiveFile())) return;

		this.#queryClient.invalidateQueries({ stale: true });
	};

	async #applyTaskUpdateToFile(
		file: TFile,
		updated: ObsidianTask,
	): Promise<void> {
		console.log("[Todoister] applyTaskUpdateToFile:", file.path, updated.id);
		const content = await this.app.vault.read(file);
		const parsed = parseContent(content);

		const lines = content.split("\n");
		let changed = false;

		const updatedLine = obsidianTaskStringify(updated);

		for (const entry of parsed) {
			if (entry.task.id !== updated.id) continue;
			if (tasksEquals(entry.task, updated)) continue;

			const original = lines[entry.lineNumber] ?? "";
			const prefix = original.slice(0, entry.from.ch);
			const next = prefix + updatedLine;

			if (next !== original) {
				lines[entry.lineNumber] = next;
				changed = true;
			}
		}

		if (changed) {
			await this.#vaultModifySelf(file, lines.join("\n"));
		}
	}

	async #removeTaskFromFile(file: TFile, taskId: string): Promise<void> {
		const content = await this.app.vault.read(file);
		const parsed = parseContent(content)
			.filter(({ task }) => task.id === taskId)
			.sort((a, b) => b.lineNumber - a.lineNumber);

		if (parsed.length === 0) return;

		const lines = content.split("\n");
		for (const entry of parsed) {
			lines.splice(entry.lineNumber, 1);
		}

		await this.#vaultModifySelf(file, lines.join("\n"));
	}

	async #refreshActiveCacheFromFile(file: TFile, allowPush = false) {
		const content = await this.app.vault.read(file);
		const parsed = parseContent(content);
		this.#updateActiveFileCache(parsed, allowPush);
	}

	#onQueryUpdate = async (
		result: QueryObserverResult<ObsidianTask | { deleted: true; id: string }>,
	) => {
		const file = this.app.workspace.getActiveFile();
		if (!file) return;

		const { data: todoistTask, status } = result;

		if (!this.#pluginIsEnabled(file)) return;
		if (!this.#checkRequirements()) return;
		if (!todoistTask || status !== "success") return;

		const cacheEntry = this.#activeFileCache.get(todoistTask.id);

		// --- Echo guard: ignore very recent local pushes (Obsidian -> Todoist -> refetch)
		const RECENT_LOCAL_EDIT_MS = 2000;
		const recentLocalEdit =
			!!cacheEntry &&
			!isObsidianCacheItem(cacheEntry) &&
			typeof cacheEntry.lastLocalEditAt === "number" &&
			Date.now() - cacheEntry.lastLocalEditAt < RECENT_LOCAL_EDIT_MS;

		if (recentLocalEdit) return;

		const editor = this.app.workspace.activeEditor?.editor;
		const inReadingView = !editor || this.#isReadingView?.();

		// --- Deleted task
		if ("deleted" in todoistTask) {
			if (!inReadingView && editor) {
				const toRemove = parseContent(editor.getValue())
					.filter(({ task }) => task.id === todoistTask.id)
					.sort((a, b) => b.from.line - a.from.line || b.from.ch - a.from.ch);

				for (const { from } of toRemove) {
					this.#replaceRange(
						editor,
						"",
						{ line: from.line, ch: 0 },
						{ line: from.line + 1, ch: 0 },
					);
				}
			} else {
				await this.#removeTaskFromFile(file, todoistTask.id);
				// IMPORTANT: refresh cache from disk so switching views won't resurrect/push stale state
				await this.#refreshActiveCacheFromFile(file, false);
			}

			this.#deleteFromActiveFileCache(todoistTask.id);
			return;
		}

		// --- Reading view (or no editor): write to file on disk, then refresh cache from disk
		if (inReadingView) {
			try {
				await this.#applyTaskUpdateToFile(file, todoistTask);
				await this.#refreshActiveCacheFromFile(file, false); // <-- CRITICAL
			} catch (e) {
				console.error("[Todoister] File update failed", e);
				new Notice(
					"Todoister: failed to apply Todoist update in Reading view (see console)",
				);
			}
			return;
		}

		// --- Live Preview / Source mode: edit via editor.replaceRange
		const updatedTaskLine = obsidianTaskStringify(todoistTask);

		const changes = parseContent(editor.getValue()).filter(
			({ task }) =>
				task.id === todoistTask.id && !tasksEquals(task, todoistTask),
		);

		for (const { from, to } of changes) {
			this.#replaceRange(editor, updatedTaskLine, from, to);
		}

		// Optional but helpful: bring cache in sync with what we just wrote (no push)
		// (prevents tiny timing windows where cache lags)
		this.#updateActiveFileCache(parseContent(editor.getValue()), false);
	};
}
