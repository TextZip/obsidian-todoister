import { MutationObserver, type QueryClient } from "@tanstack/query-core";
import { taskQueryKey } from "./task-query.ts";

export const addTaskMutationKey = (taskId: string) =>
	["add-task", taskId] as const;

export const addTaskMutation = <TData extends { id: string }>({
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
		mutationKey: addTaskMutationKey(taskId),
		mutationFn,
		onSuccess: (task) => {
			queryClient.cancelQueries({ queryKey: taskQueryKey(task.id) });
			queryClient.setQueryData(taskQueryKey(task.id), task);
		},
	});
