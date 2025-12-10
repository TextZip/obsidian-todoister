import type { TodoistApi } from "@doist/todoist-api-typescript";
import { type QueryClient, QueryObserver } from "@tanstack/query-core";
import type { ObsidianTask } from "../task/obsidian-task.ts";

export const queryTaskKey = (taskId: string) => ["task", taskId] as const;

export const queryTask = ({
	queryClient,
	taskId,
	todoistApi,
	initialData,
}: {
	queryClient: QueryClient;
	taskId: string;
	todoistApi: () => TodoistApi;
	initialData: ObsidianTask;
}) =>
	new QueryObserver(queryClient, {
		queryKey: queryTaskKey(taskId),
		queryFn: () => todoistApi().getTask(taskId),
		initialData,
		select: ({ id, checked, content }): ObsidianTask => ({
			id,
			checked,
			content,
		}),
	});
