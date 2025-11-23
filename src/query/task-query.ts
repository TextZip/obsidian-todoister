import { type QueryClient, QueryObserver } from "@tanstack/query-core";

export const taskQueryKey = (taskId: string) => ["task", taskId] as const;

export const taskQuery = <T>({
	queryClient,
	taskId,
	queryFn,
}: {
	queryClient: QueryClient;
	taskId: string;
	queryFn: () => Promise<T>;
}) =>
	new QueryObserver(queryClient, {
		queryKey: taskQueryKey(taskId),
		queryFn,
	});
