/** A time of day, with the day when it isn't today: when your plan's usage limit resets, say. */
export function clock(at: number, now = Date.now()): string {
  const time = new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return new Date(at).toDateString() === new Date(now).toDateString() ? time : `${new Date(at).toLocaleDateString([], { weekday: 'short' })} ${time}`;
}
