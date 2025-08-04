interface OTPSession {
  userId: string;
  type: 'code' | 'password';
  timestamp: number;
  otp?: string;
  confirmed?: boolean;
}

const otpSessions = new Map<string, OTPSession>();

export { otpSessions };
export type { OTPSession }; 