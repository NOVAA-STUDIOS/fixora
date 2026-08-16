class Counter {
  #count = 0;

  increment() {
    this.#count += 1;
    return this.#count;
  }
}

async function fetchTotal(ids) {
  const results = await Promise.all(ids.map((id) => Promise.resolve(id * 2)));
  const [first, ...rest] = results;
  return `first=${first}, rest=${rest.join(',')}`;
}

export { Counter, fetchTotal };
