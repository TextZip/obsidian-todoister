import { type QueryClient, QueryObserver } from "@tanstack/query-core";

export const userInfoQueryKey = () => ["user"] as const;

export const userInfoQuery = <T>({
	queryClient,
	queryFn,
}: {
	queryClient: QueryClient;
	queryFn: () => Promise<T>;
}) =>
	new QueryObserver(queryClient, {
		queryKey: userInfoQueryKey(),
		queryFn,
	});
