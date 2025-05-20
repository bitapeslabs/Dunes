/*
  These error types are to be propagated throughout the backend. Every consumer of a function that returns
  a BoxedResponse needs to properly handle the consumed functions error types. This pattern is one of the
  hardcoded rules of our code structure design patterns, this MUST be followed.
*/

/** Represents just the error shape (status: false) */
export interface IBoxedError<E extends string | number> {
  status: false;
  errorType: E;
  message?: string;
}

/** Represents just the success shape (status: true) */
export interface IBoxedSuccess<T> {
  status: true;
  data: T;
}

/** A union that can be either an error or a success */
export type BoxedResponse<T, E extends string | number> =
  | IBoxedError<E>
  | IBoxedSuccess<T>;

/** A class implementing the error shape */
export class BoxedError<E extends string | number> implements IBoxedError<E> {
  public status: false = false;
  public errorType: E;
  public message?: string;

  constructor(errorType: E, message?: string) {
    this.message = message;
    this.errorType = errorType;
  }
}

/** A class implementing the success shape */
export class BoxedSuccess<T> implements IBoxedSuccess<T> {
  public status: true = true;
  public data: T;

  constructor(data: T) {
    this.data = data;
  }
}

/**
 * Type guard checking if a BoxedResponse is a BoxedError
 */
export function isBoxedError<T, E extends string | number>(
  response: BoxedResponse<T, E>
): response is IBoxedError<E> {
  return response.status === false;
}
