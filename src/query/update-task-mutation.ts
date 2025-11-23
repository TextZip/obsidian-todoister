import { MutationObserver, type QueryClient } from "@tanstack/query-core";
import { taskQueryKey } from "./task-query.ts";

export const updateTaskMutationKey = (taskId: string) =>
	["set-content", taskId] as const;

export const updateTaskMutation = <TData>({
	queryClient,
	taskId,
	mutationFn,
}: {
	queryClient: QueryClient;
	taskId: string;
	mutationFn: (variables: { content: string }) => Promise<TData>;
}) =>
	new MutationObserver(queryClient, {
		mutationKey: updateTaskMutationKey(taskId),
		mutationFn,
		onMutate: async ({ content }) => {
			queryClient.cancelQueries({
				queryKey: taskQueryKey(taskId),
			});
			queryClient.setQueryData(taskQueryKey(taskId), (oldData: TData) => ({
				...oldData,
				content,
			}));
		},
	});
