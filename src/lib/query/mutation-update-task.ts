import { MutationObserver, type QueryClient } from "@tanstack/query-core";
import { queryTaskKey } from "./query-task.ts";

const mutationUpdateTaskKey = (taskId: string) =>
	["set-content", taskId] as const;

export const mutationUpdateTask = <TData>({
	queryClient,
	taskId,
	mutationFn,
}: {
	queryClient: QueryClient;
	taskId: string;
	mutationFn: (variables: { content: string }) => Promise<TData>;
}) =>
	new MutationObserver(queryClient, {
		mutationKey: mutationUpdateTaskKey(taskId),
		mutationFn,
		onMutate: async ({ content }) => {
			queryClient.cancelQueries({
				queryKey: queryTaskKey(taskId),
			});
			queryClient.setQueryData(queryTaskKey(taskId), (oldData: TData) => ({
				...oldData,
				content,
			}));
		},
	});
