import type { TodoistApi } from "@doist/todoist-api-typescript";
import { MutationObserver, type QueryClient } from "@tanstack/query-core";
import { queryTaskKey } from "./query-task.ts";

const mutationSetCheckedTaskKey = (taskId: string) =>
	["set-checked", taskId] as const;

export const mutationSetCheckedTask = <TData>({
	queryClient,
	taskId,
	todoistApi,
}: {
	queryClient: QueryClient;
	taskId: string;
	todoistApi: () => TodoistApi;
}) =>
	new MutationObserver(queryClient, {
		mutationKey: mutationSetCheckedTaskKey(taskId),
		mutationFn: (variables: { checked: boolean }) =>
			variables.checked
				? todoistApi().closeTask(taskId)
				: todoistApi().reopenTask(taskId),
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
