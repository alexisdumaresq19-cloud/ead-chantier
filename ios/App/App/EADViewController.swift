import UIKit
import WebKit
import Capacitor

/// The app's one screen: Capacitor's web view showing the site, with what a
/// person expects of an iPhone app that Capacitor leaves off.
class EADViewController: CAPBridgeViewController {
    private var navigationFilter: NavigationFilter?

    override func instanceDescriptor() -> InstanceDescriptor {
        let descriptor = super.instanceDescriptor()
        #if DEBUG
        // For checks in the Simulator only (scripts/ios-sim.sh): open the
        // site at another address than its home, e.g. EAD_START_PATH=/diagnostic.
        // Capacitor treats an address that does not start with server.url as
        // another site, so the site's host is allowed explicitly.
        if let path = ProcessInfo.processInfo.environment["EAD_START_PATH"], path.hasPrefix("/"),
           let server = descriptor.serverURL, let base = URL(string: server), let host = base.host,
           let start = URL(string: path, relativeTo: base)?.absoluteURL {
            descriptor.serverURL = start.absoluteString
            descriptor.allowedNavigationHostnames = descriptor.allowedNavigationHostnames + [host]
        }
        #endif
        return descriptor
    }

    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        guard let webView = webView, let capacitorDelegate = webView.navigationDelegate else { return }
        // A swipe from the left edge goes back, as in Safari and in iPhone apps.
        webView.allowsBackForwardNavigationGestures = true
        let filter = NavigationFilter(
            target: capacitorDelegate,
            siteHost: bridge?.config.serverURL.host,
            offlineURL: bridge?.config.errorPathURL
        )
        navigationFilter = filter
        webView.navigationDelegate = filter
    }
}

/// Stands between the web view and Capacitor's own navigation delegate, which
/// shows the offline page (server.errorPath) for any load that fails. A load
/// that was only interrupted is not a lost connection: one page replaced by
/// another before it arrived, or a file the web view cannot show. A page of
/// the site that failed while the app was running opens the offline page with
/// its address after "#", so that "Réessayer" brings the person back to it
/// rather than to the home screen. (A universal link that starts the app is
/// another case: the first load is the home page, and the App plugin keeps
/// the link, appUrlOpen retained until a listener reads it, for the site to
/// open once it loads.) A page whose server neither answers nor fails is
/// given up after `answerTimeout`, as if it had failed. Everything else goes
/// to Capacitor unchanged, by Objective-C message forwarding.
final class NavigationFilter: NSObject {
    /// Seconds the site may take to answer a page before the offline page
    /// shows. Without it WebKit waits 60 seconds (URLRequest's default, set by
    /// Capacitor's loadWebView, which is final) on an empty screen.
    static let answerTimeout: UInt64 = 15

    /// Capacitor's WebViewDelegationHandler, kept alive by the bridge.
    private weak var target: WKNavigationDelegate?
    private let siteHost: String?
    private let offlineURL: URL?
    /// The navigation being timed, and the wait that gives up on it.
    private weak var watched: WKNavigation?
    private var giveUp: Task<Void, Never>?

    init(target: WKNavigationDelegate, siteHost: String?, offlineURL: URL?) {
        self.target = target
        self.siteHost = siteHost
        self.offlineURL = offlineURL
        super.init()
    }

    override func responds(to aSelector: Selector!) -> Bool {
        return super.responds(to: aSelector) || (target?.responds(to: aSelector) ?? false)
    }

    override func forwardingTarget(for aSelector: Selector!) -> Any? {
        if let target = target, target.responds(to: aSelector) {
            return target
        }
        return super.forwardingTarget(for: aSelector)
    }

    static func isInterruption(_ error: Error) -> Bool {
        let error = error as NSError
        if error.domain == NSURLErrorDomain && error.code == NSURLErrorCancelled { return true }
        // WebKitErrorFrameLoadInterruptedByPolicyChange: a download, or a
        // file type the web view does not display.
        return error.domain == "WebKitErrorDomain" && error.code == 102
    }

    /// The address that failed, as the error names it.
    static func failedURL(_ error: Error) -> URL? {
        let info = (error as NSError).userInfo
        return info[NSURLErrorFailingURLErrorKey] as? URL
            ?? (info[NSURLErrorFailingURLStringErrorKey] as? String).flatMap { URL(string: $0) }
    }

    /// Whether an address is the offline page itself (any fragment).
    static func isOfflinePage(_ url: URL?, _ offline: URL?) -> Bool {
        guard let url = url, let offline = offline else { return false }
        return url.scheme == offline.scheme && url.host == offline.host && url.path == offline.path
    }

    /// The offline page with the failed page's path and query after "#",
    /// e.g. capacitor://localhost/offline.html#/i/abc. Nil when the failed
    /// address is not one of the site's: Capacitor's own handling then
    /// applies, and "Réessayer" goes to the site's home.
    static func offlinePage(_ offline: URL?, siteHost: String?, failed: URL?) -> URL? {
        guard let offline = offline, let siteHost = siteHost, let failed = failed,
              failed.host?.lowercased() == siteHost.lowercased(),
              let parts = URLComponents(url: failed, resolvingAgainstBaseURL: false),
              var page = URLComponents(url: offline, resolvingAgainstBaseURL: false) else { return nil }
        var from = parts.percentEncodedPath.isEmpty ? "/" : parts.percentEncodedPath
        if let query = parts.percentEncodedQuery { from += "?" + query }
        // Kept percent-encoded as the site wrote it; URLComponents encodes it
        // once more for the fragment ("%" too), and the page decodes it once.
        page.fragment = from
        return page.url
    }
}

// In an extension, so that the class does not take the protocol's main-actor
// isolation: responds(to:) and forwardingTarget(for:) override NSObject's,
// which have none.
extension NavigationFilter: WKNavigationDelegate {
    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        // Capacitor resets the bridge here: it goes first.
        target?.webView?(webView, didStartProvisionalNavigation: navigation)
        watch(navigation, in: webView)
    }

    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        settle(navigation)
        target?.webView?(webView, didCommit: navigation)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        settle(navigation)
        if NavigationFilter.isInterruption(error) { return }
        if offlinePageFailed(error) { return }
        if showOffline(in: webView, after: error) { return }
        target?.webView?(webView, didFailProvisionalNavigation: navigation, withError: error)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        settle(navigation)
        if NavigationFilter.isInterruption(error) { return }
        if offlinePageFailed(error) { return }
        if showOffline(in: webView, after: error) { return }
        target?.webView?(webView, didFail: navigation, withError: error)
    }

    /// Loads the offline page in Capacitor's place. What Capacitor would also
    /// have done on a first load (making the web view opaque again) still
    /// happens: the offline page's own didFinish reaches it through this filter.
    private func showOffline(in webView: WKWebView, after error: Error) -> Bool {
        let failed = NavigationFilter.failedURL(error)
        guard let url = NavigationFilter.offlinePage(offlineURL, siteHost: siteHost, failed: failed) else { return false }
        CAPLog.print("EAD: page failed to load, offline page shown: " + error.localizedDescription)
        webView.load(URLRequest(url: url))
        return true
    }

    /// Capacitor answers a failed load by loading the offline page; if that
    /// page itself failed (missing from the app), it would load it again
    /// without end. The failure is only written to the log.
    private func offlinePageFailed(_ error: Error) -> Bool {
        guard NavigationFilter.isOfflinePage(NavigationFilter.failedURL(error), offlineURL) else { return false }
        CAPLog.print("EAD: offline page failed to load: " + error.localizedDescription)
        return true
    }

    /// Starts the wait for a page's first answer. If none has come after
    /// `answerTimeout` seconds, the load is stopped (WebKit reports it as
    /// cancelled, which this filter drops) and the offline page shown with
    /// the page's address after "#". The web view's URL is the address being
    /// loaded while the load is provisional (WebKit's PageLoadState::activeURL).
    private func watch(_ navigation: WKNavigation?, in webView: WKWebView) {
        giveUp?.cancel()
        watched = navigation
        giveUp = Task { @MainActor [weak self, weak webView] in
            do {
                try await Task.sleep(nanoseconds: NavigationFilter.answerTimeout * 1_000_000_000)
            } catch {
                return
            }
            guard !Task.isCancelled, let self = self, let webView = webView, webView.isLoading else { return }
            self.giveUp = nil
            self.watched = nil
            let address = webView.url
            if NavigationFilter.isOfflinePage(address, self.offlineURL) { return }
            guard let page = NavigationFilter.offlinePage(self.offlineURL, siteHost: self.siteHost, failed: address)
                    ?? self.offlineURL else { return }
            CAPLog.print("EAD: no answer after \(NavigationFilter.answerTimeout) s, offline page shown")
            webView.stopLoading()
            webView.load(URLRequest(url: page))
        }
    }

    /// The watched page answered or failed: no more waiting for it.
    private func settle(_ navigation: WKNavigation?) {
        guard navigation == nil || watched == nil || navigation === watched else { return }
        giveUp?.cancel()
        giveUp = nil
        watched = nil
    }
}
