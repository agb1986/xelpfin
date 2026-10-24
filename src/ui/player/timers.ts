export function cancel(t: ReturnType<typeof setTimeout> | undefined) {
  if (t) {
    clearTimeout(t);
  }
}
