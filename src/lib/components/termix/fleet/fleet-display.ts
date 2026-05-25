const fleetTimestampFormatter = new Intl.DateTimeFormat(undefined, {
	dateStyle: 'medium',
	timeStyle: 'short'
});

export function formatFleetTimestamp(value: string | null | undefined, fallback = 'Not available') {
	if (!value) return fallback;

	const timestamp = new Date(value);
	if (Number.isNaN(timestamp.getTime())) return value;

	return fleetTimestampFormatter.format(timestamp);
}
