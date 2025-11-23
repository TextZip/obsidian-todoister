import { MutationObserver, type QueryClient } from "@tanstack/query-core";
import { queryTaskKey } from "./query-task.ts";

const mutationSetCheckedTaskKey = (taskId: string) =>
	["set-checked", taskId] as const;

export const mutationSetCheckedTask = <TData>({
	queryClient,
	taskId,
	mutationFn,
}: {
	queryClient: QueryClient;
	taskId: string;
	mutationFn: (variables: { checked: boolean }) => Promise<TData>;
}) =>
	new MutationObserver(queryClient, {
		mutationKey: mutationSetCheckedTaskKey(taskId),
		mutationFn,
		onMutate: ({ checked }) => {
			queryClient.cancelQueries({
				queryKey: queryTaskKey(taskId),
			});
			queryClient.setQueryData(queryTaskKey(taskId), (oldData: TData) => ({
				...oldData,
				checked,
			}));
		},
	});
