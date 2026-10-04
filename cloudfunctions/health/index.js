// Day 15：只检查云函数能否被调用，不读取配置、不连接数据库。
exports.main = async function () {
  return {
    ok: true,
    service: "next-meal",
  };
};
