const response = await fetch("http://127.0.0.1:4004/generate-report", {
  method: "POST",
});
const result = await response.json();
console.log(result);
