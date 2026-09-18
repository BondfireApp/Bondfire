export async function encryptBlob(data) {
  return btoa(JSON.stringify(data));
}

export async function decryptBlob(data) {
  return JSON.parse(atob(data));
}
