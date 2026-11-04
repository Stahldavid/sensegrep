/** Match the core's profile selection and pass it explicitly into each CLI operation. */
export function cliProfile(profile?: string): string {
  const effective = (profile || process.env.SENSEGREP_PROFILE || "default").trim()
  if (!/^[A-Za-z0-9._-]+$/.test(effective)) throw new Error(`Invalid sensegrep profile "${effective}". Use letters, numbers, dot, underscore, or hyphen.`)
  return effective
}
