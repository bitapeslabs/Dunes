function simplify(obj: object): object {
  let flattenedObject = { ...obj };

  const isObject = (value: unknown): boolean =>
    typeof value === "object" && !Array.isArray(value) && value !== null;
  const checkForFlatten = () =>
    Object.values(flattenedObject).filter((value) =>
      isObject(value) ? Object.values(value ?? {})?.length > 0 : false
    ).length !== 0;

  while (checkForFlatten()) {
    let flattenedGroup = {} as Record<string, unknown>;
    for (let [key, value] of Object.entries(flattenedObject)) {
      if (isObject(value) && Object.keys(value as object).length === 1) {
        flattenedGroup[key] = Object.values(value as object)[0];
      } else if (isObject(value)) {
        flattenedGroup = { ...flattenedGroup, ...(value as object) };
      } else {
        flattenedGroup[key] = value;
      }
    }
    flattenedObject = { ...flattenedGroup };
  }

  return flattenedObject;
}
