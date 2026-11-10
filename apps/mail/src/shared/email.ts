const emailPattern =
  /^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$/;
export const validEmail = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length <= 254 &&
  !/[\s\r\n]/.test(value) &&
  emailPattern.test(value);
