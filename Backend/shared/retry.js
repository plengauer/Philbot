
async function delay(time) {
  return new Promise(resolve => setTimeout(resolve, time));
}

async function retry(func, should_retry_on_error = e => true) {
  let wait = 1000;
  for(;;) {
    try {
      return await func();
    } catch (error) {
      if (!should_retry_on_error(error)) throw error;
      if (wait > 1000 * 60 * 30) throw error;
      console.error("Retry due to: " + error);
      await delay(wait);
      wait *= 2;
    }
  }
}

module.exports = { retry, delay }