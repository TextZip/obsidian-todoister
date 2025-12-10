import type { CurrentUser, TodoistApi } from "@doist/todoist-api-typescript";
import { type QueryClient, QueryObserver } from "@tanstack/query-core";

const queryUserInfoKey = () => ["user"] as const;

export const queryUserInfo = ({
	queryClient,
	todoistApi,
}: {
	queryClient: QueryClient;
	todoistApi: () => TodoistApi;
}) =>
	new QueryObserver<CurrentUser>(queryClient, {
		queryKey: queryUserInfoKey(),
		queryFn: () => todoistApi().getUser(),
	});
