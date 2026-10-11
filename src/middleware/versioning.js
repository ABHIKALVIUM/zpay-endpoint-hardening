/**
 * Backward compatibility normalization middleware for API versioning.
 * In v1, accept both amount_inr and amount fields.
 * If client sends amount_inr but not amount, use amount_inr as a fallback.
 * If both are sent, prioritize amount.
 */
function normaliseFields(req, res, next) {
  // v1 compat: amount_inr → amount
  if (req.body && req.body.amount_inr !== undefined && req.body.amount === undefined) {
    req.body.amount = req.body.amount_inr;
    // v2: remove amount_inr fallback
  }
  next();
}

module.exports = {
  normaliseFields
};
