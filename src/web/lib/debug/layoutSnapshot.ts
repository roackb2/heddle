export type LayoutSnapshotContext = {
  activeTab: string;
  selectedSessionId?: string;
  selectedTurnId?: string;
  mobileView?: string;
  runActive?: boolean;
  pendingApproval?: {
    tool: string;
    callId: string;
    input?: unknown;
  } | null;
  selectedModel?: string;
  driftEnabled?: boolean;
  driftLevel?: string;
  toastCount?: number;
  latestToasts?: Array<{ title: string; tone?: string }>;
  errors?: string[];
};

export type ScreenshotMode = 'none' | 'auto';

export type LayoutSnapshotOptions = {
  context: LayoutSnapshotContext;
  screenshot?: ScreenshotMode;
};

export type LayoutSnapshot = {
  version: 1;
  capturedAt: string;
  url: string;
  title: string;
  viewport: ViewportSnapshot;
  appState: LayoutSnapshotContext & {
    pendingApproval?: {
      tool: string;
      callId: string;
      inputSummary?: InputSummary;
    } | null;
  };
  dom: {
    html: string;
    activeElement?: ElementSnapshot;
    landmarks: ElementSnapshot[];
    scrollContainers: ScrollContainerSnapshot[];
    focusableElements: ElementSnapshot[];
    problemChecks: ProblemCheck[];
  };
  screenshot: ScreenshotSnapshot;
};

type ViewportSnapshot = {
  innerWidth: number;
  innerHeight: number;
  visualViewport?: {
    width: number;
    height: number;
    offsetTop: number;
    offsetLeft: number;
    scale: number;
  };
  devicePixelRatio: number;
  userAgent: string;
  orientation?: string;
};

type RectSnapshot = {
  x: number;
  y: number;
  width: number;
  height: number;
  top: number;
  right: number;
  bottom: number;
  left: number;
};

type ElementSnapshot = {
  selector: string;
  tagName: string;
  textPreview?: string;
  role?: string;
  ariaLabel?: string;
  className?: string;
  rect: RectSnapshot;
  computed: {
    display: string;
    visibility: string;
    position: string;
    overflow: string;
    overflowX: string;
    overflowY: string;
    zIndex: string;
    pointerEvents: string;
  };
  visibleInViewport: boolean;
  clippedByAncestors: string[];
};

type ScrollContainerSnapshot = {
  selector: string;
  rect: RectSnapshot;
  scrollTop: number;
  scrollLeft: number;
  scrollHeight: number;
  scrollWidth: number;
  clientHeight: number;
  clientWidth: number;
  overflowX: string;
  overflowY: string;
  canScrollY: boolean;
  atTop: boolean;
  atBottom: boolean;
};

type ProblemCheck = {
  id: string;
  severity: 'low' | 'medium' | 'high';
  selector: string;
  message: string;
};

type ScreenshotSnapshot =
  | {
      status: 'captured';
      kind: 'screen-capture-frame';
      dataUrl: string;
      width: number;
      height: number;
    }
  | {
      status: 'unavailable' | 'failed';
      reason: string;
    };

type InputSummary = {
  type: string;
  approxBytes: number;
  keys?: string[];
  preview?: string;
};

const LANDMARK_SELECTORS = [
  '.workspace-shell',
  '.mobile-session-screen',
  '.mobile-chat-pane',
  '.conversation-scroll',
  '.composer-shell',
  '.approval-card',
  '.approval-card .code-block',
  '.approval-actions',
  '.approval-actions button',
  '.mention-menu',
  '.toast-viewport',
  '[role="dialog"]',
  '[aria-modal="true"]',
];

const FOCUSABLE_SELECTOR = [
  'button',
  'a[href]',
  'input',
  'textarea',
  'select',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export async function captureControlPlaneLayoutSnapshot(options: LayoutSnapshotOptions): Promise<LayoutSnapshot> {
  const landmarks = captureLandmarks();
  const scrollContainers = captureScrollContainers();
  const focusableElements = Array.from(document.querySelectorAll(FOCUSABLE_SELECTOR))
    .slice(0, 80)
    .map((element, index) => snapshotElement(element, getElementSelector(element, index)))
    .filter((snapshot): snapshot is ElementSnapshot => Boolean(snapshot));

  const screenshot = options.screenshot === 'auto' ? await captureScreenshot() : {
    status: 'unavailable' as const,
    reason: 'Screenshot capture was not requested.',
  };

  return {
    version: 1,
    capturedAt: new Date().toISOString(),
    url: window.location.href,
    title: document.title,
    viewport: captureViewport(),
    appState: sanitizeContext(options.context),
    dom: {
      html: capText(redactText(document.documentElement.outerHTML), 240_000),
      activeElement: document.activeElement ? snapshotElement(document.activeElement, 'document.activeElement') : undefined,
      landmarks,
      scrollContainers,
      focusableElements,
      problemChecks: runProblemChecks(landmarks, scrollContainers, focusableElements),
    },
    screenshot,
  };
}

function captureViewport(): ViewportSnapshot {
  const visualViewport = window.visualViewport ? {
    width: window.visualViewport.width,
    height: window.visualViewport.height,
    offsetTop: window.visualViewport.offsetTop,
    offsetLeft: window.visualViewport.offsetLeft,
    scale: window.visualViewport.scale,
  } : undefined;

  return {
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    visualViewport,
    devicePixelRatio: window.devicePixelRatio,
    userAgent: window.navigator.userAgent,
    orientation: screen.orientation?.type,
  };
}

function captureLandmarks(): ElementSnapshot[] {
  return LANDMARK_SELECTORS.flatMap((selector) => (
    Array.from(document.querySelectorAll(selector))
      .slice(0, 12)
      .map((element, index) => snapshotElement(element, index === 0 ? selector : `${selector}:nth-match(${index + 1})`))
      .filter((snapshot): snapshot is ElementSnapshot => Boolean(snapshot))
  ));
}

function captureScrollContainers(): ScrollContainerSnapshot[] {
  const containers = Array.from(document.querySelectorAll<HTMLElement>('body, body *'))
    .filter((element) => {
      const style = window.getComputedStyle(element);
      const canScrollY = element.scrollHeight > element.clientHeight + 1;
      const canScrollX = element.scrollWidth > element.clientWidth + 1;
      return canScrollY || canScrollX || /(auto|scroll|hidden|clip)/.test(`${style.overflowX} ${style.overflowY}`);
    })
    .slice(0, 120);

  return containers.map((element, index) => {
    const style = window.getComputedStyle(element);
    return {
      selector: getElementSelector(element, index),
      rect: rectToSnapshot(element.getBoundingClientRect()),
      scrollTop: element.scrollTop,
      scrollLeft: element.scrollLeft,
      scrollHeight: element.scrollHeight,
      scrollWidth: element.scrollWidth,
      clientHeight: element.clientHeight,
      clientWidth: element.clientWidth,
      overflowX: style.overflowX,
      overflowY: style.overflowY,
      canScrollY: element.scrollHeight > element.clientHeight + 1,
      atTop: element.scrollTop <= 1,
      atBottom: element.scrollTop + element.clientHeight >= element.scrollHeight - 1,
    };
  });
}

function snapshotElement(element: Element, selector: string): ElementSnapshot | undefined {
  if (!(element instanceof HTMLElement) && !(element instanceof SVGElement)) {
    return undefined;
  }

  const style = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return {
    selector,
    tagName: element.tagName.toLowerCase(),
    textPreview: getTextPreview(element),
    role: element.getAttribute('role') ?? undefined,
    ariaLabel: element.getAttribute('aria-label') ?? undefined,
    className: typeof element.className === 'string' ? element.className : undefined,
    rect: rectToSnapshot(rect),
    computed: {
      display: style.display,
      visibility: style.visibility,
      position: style.position,
      overflow: style.overflow,
      overflowX: style.overflowX,
      overflowY: style.overflowY,
      zIndex: style.zIndex,
      pointerEvents: style.pointerEvents,
    },
    visibleInViewport: isRectVisibleInViewport(rect),
    clippedByAncestors: getClippingAncestors(element),
  };
}

function runProblemChecks(
  landmarks: ElementSnapshot[],
  scrollContainers: ScrollContainerSnapshot[],
  focusableElements: ElementSnapshot[],
): ProblemCheck[] {
  const checks: ProblemCheck[] = [];
  const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
  const approvalButtons = focusableElements.filter((element) => (
    element.selector.includes('button')
    && /approve|deny/i.test(element.textPreview ?? '')
  ));

  for (const button of approvalButtons) {
    if (button.rect.bottom > viewportHeight && !hasScrollableContainerAtBottom(scrollContainers)) {
      checks.push({
        id: 'approval-action-unreachable',
        severity: 'high',
        selector: button.selector,
        message: 'Approval action is below the visual viewport and no captured scroll container appears able to scroll further.',
      });
    }

    if (button.clippedByAncestors.length > 0) {
      checks.push({
        id: 'interactive-control-clipped',
        severity: 'high',
        selector: button.selector,
        message: `Interactive control may be clipped by ${button.clippedByAncestors.join(', ')}.`,
      });
    }
  }

  const composer = landmarks.find((element) => element.selector === '.composer-shell');
  if (composer && window.innerWidth <= 760 && composer.rect.height > viewportHeight * 0.62) {
    checks.push({
      id: 'composer-exceeds-mobile-viewport',
      severity: 'medium',
      selector: '.composer-shell',
      message: 'Composer consumes more than 62% of the visual viewport on mobile.',
    });
  }

  for (const element of focusableElements) {
    const looksImportant = /approve|deny|send|continue|cancel|submit|save/i.test(
      `${element.textPreview ?? ''} ${element.ariaLabel ?? ''} ${element.selector}`,
    );
    if (looksImportant && (element.rect.width <= 0 || element.rect.height <= 0 || element.computed.display === 'none' || element.computed.visibility === 'hidden')) {
      checks.push({
        id: 'hidden-or-zero-size-control',
        severity: 'medium',
        selector: element.selector,
        message: 'Focusable control is hidden or has zero rendered size.',
      });
    }
  }

  return checks;
}

async function captureScreenshot(): Promise<ScreenshotSnapshot> {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    return {
      status: 'unavailable',
      reason: 'Browser does not support getDisplayMedia screenshot capture.',
    };
  }

  let stream: MediaStream | undefined;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        displaySurface: 'browser',
      },
      audio: false,
    });
    const video = document.createElement('video');
    video.srcObject = stream;
    video.muted = true;
    await video.play();
    await new Promise<void>((resolve) => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        resolve();
        return;
      }
      video.onloadedmetadata = () => resolve();
    });

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) {
      return {
        status: 'failed',
        reason: 'Could not create a canvas context for screenshot capture.',
      };
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return {
      status: 'captured',
      kind: 'screen-capture-frame',
      dataUrl: canvas.toDataURL('image/png'),
      width: canvas.width,
      height: canvas.height,
    };
  } catch (error) {
    return {
      status: 'failed',
      reason: error instanceof Error ? error.message : String(error),
    };
  } finally {
    stream?.getTracks().forEach((track) => track.stop());
  }
}

function sanitizeContext(context: LayoutSnapshotContext): LayoutSnapshot['appState'] {
  const pendingApproval = context.pendingApproval ? {
    tool: context.pendingApproval.tool,
    callId: context.pendingApproval.callId,
    inputSummary: summarizeInput(context.pendingApproval.input),
  } : null;

  return {
    ...context,
    pendingApproval,
    latestToasts: context.latestToasts?.slice(-5),
    errors: context.errors?.filter(Boolean).slice(-8),
  };
}

function summarizeInput(input: unknown): InputSummary {
  const serialized = safeJson(input);
  const keys = input && typeof input === 'object' && !Array.isArray(input) ? Object.keys(input).slice(0, 20) : undefined;
  return {
    type: Array.isArray(input) ? 'array' : typeof input,
    approxBytes: new Blob([serialized]).size,
    keys,
    preview: capText(redactText(serialized), 900),
  };
}

function getTextPreview(element: Element): string | undefined {
  const text = element.textContent?.replace(/\s+/g, ' ').trim();
  return text ? capText(redactText(text), 240) : undefined;
}

function getClippingAncestors(element: Element): string[] {
  const ancestors: string[] = [];
  let current = element.parentElement;
  while (current && current !== document.body && ancestors.length < 8) {
    const style = window.getComputedStyle(current);
    const clips = /(hidden|clip)/.test(`${style.overflowX} ${style.overflowY}`);
    if (clips) {
      ancestors.push(getElementSelector(current, ancestors.length));
    }
    current = current.parentElement;
  }
  return ancestors;
}

function getElementSelector(element: Element, fallbackIndex: number): string {
  if (element.id) {
    return `#${CSS.escape(element.id)}`;
  }
  const className = typeof element.className === 'string' ? element.className.trim().split(/\s+/).filter(Boolean).slice(0, 3) : [];
  if (className.length > 0) {
    return `${element.tagName.toLowerCase()}.${className.map((part) => CSS.escape(part)).join('.')}`;
  }
  return `${element.tagName.toLowerCase()}:nth-of-type(${fallbackIndex + 1})`;
}

function hasScrollableContainerAtBottom(containers: ScrollContainerSnapshot[]): boolean {
  return containers.some((container) => container.canScrollY && !container.atBottom);
}

function isRectVisibleInViewport(rect: DOMRect): boolean {
  const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
  const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
  return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < viewportHeight && rect.left < viewportWidth;
}

function rectToSnapshot(rect: DOMRect): RectSnapshot {
  return {
    x: round(rect.x),
    y: round(rect.y),
    width: round(rect.width),
    height: round(rect.height),
    top: round(rect.top),
    right: round(rect.right),
    bottom: round(rect.bottom),
    left: round(rect.left),
  };
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function capText(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}\n...[truncated ${value.length - maxLength} chars]` : value;
}

function redactText(value: string): string {
  return value
    .replace(/(sk-[A-Za-z0-9_-]{12,})/g, '[redacted-openai-key]')
    .replace(/(gh[pousr]_[A-Za-z0-9_]{20,})/g, '[redacted-github-token]')
    .replace(/(AKIA[0-9A-Z]{16})/g, '[redacted-aws-key]')
    .replace(/("?(?:api[_-]?key|token|secret|password)"?\s*[:=]\s*)"[^"]+"/gi, '$1"[redacted]"');
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
