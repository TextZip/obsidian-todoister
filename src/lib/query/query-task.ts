import { type QueryClient, QueryObserver } from "@tanstack/query-core";

export const queryTaskKey = (taskId: string) => ["task", taskId] as const;

export const queryTask = <T>({
	queryClient,
	taskId,
	queryFn,
}: {
	queryClient: QueryClient;
	taskId: string;
	queryFn: () => Promise<T>;
}) =>
	new QueryObserver(queryClient, {
		queryKey: queryTaskKey(taskId),
		queryFn,
	});
