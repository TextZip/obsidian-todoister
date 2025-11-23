import { MutationObserver, type QueryClient } from "@tanstack/query-core";
import { queryTaskKey } from "./query-task.ts";

const mutationAddTaskKey = (taskId: string) => ["add-task", taskId] as const;

export const mutationAddTask = <TData extends { id: string }>({
	queryClient,
	taskId,
	mutationFn,
}: {
	queryClient: QueryClient;
	taskId: string;
	mutationFn: (variables: {
		content: string;
		checked: boolean;
	}) => Promise<TData>;
}) =>
	new MutationObserver(queryClient, {
		mutationKey: mutationAddTaskKey(taskId),
		mutationFn,
		onSuccess: (task) => {
			queryClient.cancelQueries({ queryKey: queryTaskKey(task.id) });
			queryClient.setQueryData(queryTaskKey(task.id), task);
		},
	});
