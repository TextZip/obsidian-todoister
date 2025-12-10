import type { TodoistApi } from "@doist/todoist-api-typescript";

export function getTodoistApi(
	todoistApiGetter: () => TodoistApi | undefined,
): TodoistApi {
	const todoistApi = todoistApiGetter();

	if (!todoistApi) {
		throw new Error("TodoistApi is not initialized");
	}

	return todoistApi;
}
