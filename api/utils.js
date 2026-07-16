export function generateRef(type = "PDF") {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `${type}-ORD-${date}-${rand}`;
}

export function generateShopeeCode(designId) {
  const chars = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
  let suffix = "";
  for (let i = 0; i < 6; i++) {
    suffix += chars[Math.floor(Math.random() * chars.length)];
  }
  return `${designId.toUpperCase()}-${suffix}`;
}