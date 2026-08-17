export function canonicalizeTopic(topic: string): string {
	return topic.trim().toLowerCase().replace(/[\s_-]+/g, "-");
}

export function canonicalizeTopics(topics: string[]): string[] {
	const seen = new Set<string>();
	const canonical: string[] = [];
	for (const topic of topics) {
		const value = canonicalizeTopic(topic);
		if (!value || seen.has(value)) continue;
		seen.add(value);
		canonical.push(value);
	}
	return canonical;
}

export function canonicalizeStoredTopics(raw: string): string | null {
	try {
		const topics: unknown = JSON.parse(raw);
		return Array.isArray(topics) && topics.every((topic) => typeof topic === "string")
			? JSON.stringify(canonicalizeTopics(topics))
			: null;
	} catch {
		return null;
	}
}

export function topicLikePattern(topic: string): string {
	return `%"${canonicalizeTopic(topic)}"%`;
}
