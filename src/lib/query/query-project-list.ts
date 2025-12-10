import type { TodoistApi } from "@doist/todoist-api-typescript";
import { type QueryClient, QueryObserver } from "@tanstack/query-core";

const queryProjectListKey = () => ["projects"] as const;

export const queryProjectList = ({
	queryClient,
	todoistApi,
}: {
	queryClient: QueryClient;
	todoistApi: () => TodoistApi;
}) =>
	new QueryObserver(queryClient, {
		queryKey: queryProjectListKey(),
		queryFn: () => todoistApi().getProjects(),
		select: ({ results }) => results.map(({ id, name }) => ({ id, name })),
	});
