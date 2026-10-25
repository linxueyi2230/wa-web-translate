import SparkMD5 from "spark-md5";
export function md5(bytes: Uint8Array): string {
  const digest = SparkMD5.ArrayBuffer.hash(bytes.slice().buffer, true);
  return btoa(digest);
}
