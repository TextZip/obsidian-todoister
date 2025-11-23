import { type QueryClient, QueryObserver } from "@tanstack/query-core";

const queryUserInfoKey = () => ["user"] as const;

export const queryUserInfo = <T>({
	queryClient,
	queryFn,
}: {
	queryClient: QueryClient;
	queryFn: () => Promise<T>;
}) =>
	new QueryObserver(queryClient, {
		queryKey: queryUserInfoKey(),
		queryFn,
	});
