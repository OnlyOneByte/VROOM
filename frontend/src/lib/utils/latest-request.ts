export type IsCurrentRequest = () => boolean;

export function latest(): () => IsCurrentRequest {
	let latestId = 0;
	return () => {
		const id = ++latestId;
		return () => id === latestId;
	};
}
