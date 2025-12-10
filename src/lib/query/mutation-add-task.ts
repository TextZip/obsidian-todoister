import type { TodoistApi } from "@doist/todoist-api-typescript";
import { MutationObserver, type QueryClient } from "@tanstack/query-core";
import { queryTaskKey } from "./query-task.ts";

const mutationAddTaskKey = (taskId: string) => ["add-task", taskId] as const;

export const mutationAddTask = ({
	queryClient,
	taskId,
	todoistApi,
	projectId,
}: {
	queryClient: QueryClient;
	taskId: string;
	todoistApi: () => TodoistApi;
	projectId: string;
}) =>
	new MutationObserver(queryClient, {
		mutationKey: mutationAddTaskKey(taskId),
		mutationFn: (variables: { content: string; checked: boolean }) =>
			todoistApi().addTask({
				content: variables.content,
				projectId,
			}),
		onSuccess: (task) => {
			queryClient.cancelQueries({ queryKey: queryTaskKey(task.id) });
			queryClient.setQueryData(queryTaskKey(task.id), task);
		},
	});
