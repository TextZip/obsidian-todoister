import { type QueryClient, QueryObserver } from "@tanstack/query-core";

const queryProjectListKey = () => ["projects"] as const;

export const queryProjectList = <T>({
	queryClient,
	queryFn,
}: {
	queryClient: QueryClient;
	queryFn: () => Promise<T>;
}) =>
	new QueryObserver(queryClient, {
		queryKey: queryProjectListKey(),
		queryFn,
	});
