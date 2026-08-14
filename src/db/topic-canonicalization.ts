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
