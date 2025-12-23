import Sqids from "sqids";

const sqids = new Sqids({
  minLength: 5,
  alphabet: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
});

export const sqidEncode = (id: number | bigint) => sqids.encode([Number(id)]);
export const sqidDecode = (id: string) => sqids.decode(id)[0];
