import { type QueryClient, QueryObserver } from "@tanstack/query-core";

export const projectListQueryKey = () => ["projects"] as const;

export const projectListQuery = <T>({
	queryClient,
	queryFn,
}: {
	queryClient: QueryClient;
	queryFn: () => Promise<T>;
}) =>
	new QueryObserver(queryClient, {
		queryKey: projectListQueryKey(),
		queryFn,
	});
