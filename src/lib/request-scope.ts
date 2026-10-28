/** Own a sequence of reads; old completions cannot publish into a newer view. */
export function createRequestScope() {
  let generation = 0;
  let active = true;
  return {
    begin() {
      const ticket = ++generation;
      return () => active && ticket === generation;
    },
    activate() {
      active = true;
    },
    invalidate() {
      active = false;
      generation++;
    },
  };
}
