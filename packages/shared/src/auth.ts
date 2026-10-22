export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export function passwordRequirements(password: string) {
  return [
    {
      id: "length",
      label: "至少 8 个字符",
      met: Array.from(password).length >= PASSWORD_MIN_LENGTH,
    },
    {
      id: "uppercase",
      label: "包含大写字母（A–Z）",
      met: /[A-Z]/.test(password),
    },
    {
      id: "lowercase",
      label: "包含小写字母（a–z）",
      met: /[a-z]/.test(password),
    },
    { id: "digit", label: "包含数字（0–9）", met: /[0-9]/.test(password) },
  ];
}

export function passwordIssues(password: string) {
  const missing = {
    length: { code: "PASSWORD_TOO_SHORT", message: "密码至少需要 8 个字符" },
    uppercase: {
      code: "PASSWORD_UPPERCASE_REQUIRED",
      message: "缺少大写字母（A–Z）",
    },
    lowercase: {
      code: "PASSWORD_LOWERCASE_REQUIRED",
      message: "缺少小写字母（a–z）",
    },
    digit: { code: "PASSWORD_DIGIT_REQUIRED", message: "缺少数字（0–9）" },
  };
  const issues = passwordRequirements(password)
    .filter((rule) => !rule.met)
    .map((rule) => missing[rule.id as keyof typeof missing]);
  if (Array.from(password).length > PASSWORD_MAX_LENGTH)
    issues.push({
      code: "PASSWORD_TOO_LONG",
      message: "密码最多允许 128 个字符",
    });
  return issues;
}
