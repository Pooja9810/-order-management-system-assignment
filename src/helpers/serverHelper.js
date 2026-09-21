export const ok = (res, json) => {
  return res.status(200).json(json);
};
export const notok = (res, json) => {
  return res.status(500).json(json);
};
export const created = (res, json) => {
  return res.status(201).json(json);
};
export const notfound = (res, json) => {
  return res.status(404).json(json);
};
export const badrequest = (res, json) => {
  return res.status(400).json(json);
};
