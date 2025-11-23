import { MutationObserver, type QueryClient } from "@tanstack/query-core";
import { taskQueryKey } from "./task-query.ts";

export const setCheckedTaskMutationKey = (taskId: string) =>
	["set-checked", taskId] as const;

export const setCheckedTaskMutation = <TData>({
	queryClient,
	taskId,
	mutationFn,
}: {
	queryClient: QueryClient;
	taskId: string;
	mutationFn: (variables: { checked: boolean }) => Promise<TData>;
}) =>
	new MutationObserver(queryClient, {
		mutationKey: setCheckedTaskMutationKey(taskId),
		mutationFn,
		onMutate: ({ checked }) => {
			queryClient.cancelQueries({
				queryKey: taskQueryKey(taskId),
			});
			queryClient.setQueryData(taskQueryKey(taskId), (oldData: TData) => ({
				...oldData,
				checked,
			}));
		},
	});
