const ERROR_MESSAGES: Record<number, string> = {
  100: "Not enough collateral locked",
  101: "Loan repayment failed",
  102: "Unauthorized: admin access required",
  103: "Receiver callback failed",
  104: "Invalid amount: must be greater than zero",
  105: "Protocol is paused",
  106: "Receiver contract not approved",
  107: "Loan exceeds single-loan limit",
  108: "Block volume limit exceeded",
  109: "PoX call failed",
};

export function getErrorMessage(code: number): string {
  return ERROR_MESSAGES[code] ?? `Unknown error (u${code})`;
}

export function parseContractError(errorString: string): string | null {
  const match = errorString.match(/u(\d+)/);
  if (!match) return null;
  return getErrorMessage(parseInt(match[1], 10));
}
