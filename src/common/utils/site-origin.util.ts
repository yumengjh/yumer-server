const SUBDOMAIN_WILDCARD_PATTERN = /^(https?):\/\/\*\.(.+)$/i;

type SubdomainWildcardRule = {
  type: 'subdomain-wildcard';
  protocol: string;
  hostnameSuffix: string;
  port: string;
};

const parseSubdomainWildcardRule = (pattern: string): SubdomainWildcardRule | null => {
  const match = pattern.match(SUBDOMAIN_WILDCARD_PATTERN);
  if (!match) {
    return null;
  }

  const [, protocol, hostAndPort] = match;
  const [hostnameSuffix, port = ''] = hostAndPort.toLowerCase().split(':');
  if (!hostnameSuffix) {
    return null;
  }

  return {
    type: 'subdomain-wildcard',
    protocol: protocol.toLowerCase(),
    hostnameSuffix,
    port,
  };
};

export const normalizeOrigin = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return new URL(trimmed).origin.toLowerCase();
  } catch {
    return null;
  }
};

export const normalizeSiteOriginPattern = (value: string): string | null => {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }

  if (trimmed === '*') {
    return '*';
  }

  if (parseSubdomainWildcardRule(trimmed)) {
    return trimmed;
  }

  return normalizeOrigin(trimmed);
};

export const parseSiteOriginPatterns = (value: string | undefined): string[] => {
  if (!value) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .split(',')
        .map((item) => normalizeSiteOriginPattern(item))
        .filter((item): item is string => Boolean(item)),
    ),
  );
};

export const isOriginAllowedByPatterns = (
  requestOrigin: string,
  allowedPatterns: string[],
): boolean => {
  if (allowedPatterns.includes('*')) {
    return true;
  }

  const normalizedOrigin = normalizeOrigin(requestOrigin);
  if (!normalizedOrigin) {
    return false;
  }

  const requestUrl = new URL(normalizedOrigin);

  return allowedPatterns.some((pattern) => {
    if (pattern === normalizedOrigin) {
      return true;
    }

    const wildcardRule = parseSubdomainWildcardRule(pattern);
    if (!wildcardRule) {
      return false;
    }

    const requestProtocol = requestUrl.protocol.replace(/:$/, '').toLowerCase();
    const requestHostname = requestUrl.hostname.toLowerCase();
    const requestPort = requestUrl.port;

    return (
      requestProtocol === wildcardRule.protocol &&
      requestHostname !== wildcardRule.hostnameSuffix &&
      requestHostname.endsWith(`.${wildcardRule.hostnameSuffix}`) &&
      requestPort === wildcardRule.port
    );
  });
};
