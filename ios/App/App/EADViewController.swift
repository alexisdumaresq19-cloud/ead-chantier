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
/// the site that failed opens the offline page with its address after "#",
/// so that "Réessayer" brings the person back to it (an invitation link, a
/// project opened from a universal link) rather than to the home screen.
/// Everything else goes to Capacitor unchanged, by Objective-C message
/// forwarding.
final class NavigationFilter: NSObject {
    /// Capacitor's WebViewDelegationHandler, kept alive by the bridge.
    private weak var target: WKNavigationDelegate?
    private let siteHost: String?
    private let offlineURL: URL?

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

    /// The offline page with the failed page's path and query after "#",
    /// e.g. capacitor://localhost/offline.html#/i/abc. Nil when the failed
    /// address is not one of the site's: Capacitor's own handling then
    /// applies, and "Réessayer" goes to the site's home.
    static func offlinePage(_ offline: URL?, siteHost: String?, after error: Error) -> URL? {
        let info = (error as NSError).userInfo
        let failed = info[NSURLErrorFailingURLErrorKey] as? URL
            ?? (info[NSURLErrorFailingURLStringErrorKey] as? String).flatMap { URL(string: $0) }
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
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if NavigationFilter.isInterruption(error) { return }
        if showOffline(in: webView, after: error) { return }
        target?.webView?(webView, didFailProvisionalNavigation: navigation, withError: error)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        if NavigationFilter.isInterruption(error) { return }
        if showOffline(in: webView, after: error) { return }
        target?.webView?(webView, didFail: navigation, withError: error)
    }

    /// Loads the offline page in Capacitor's place. What Capacitor would also
    /// have done on a first load (making the web view opaque again) still
    /// happens: the offline page's own didFinish reaches it through this filter.
    private func showOffline(in webView: WKWebView, after error: Error) -> Bool {
        guard let url = NavigationFilter.offlinePage(offlineURL, siteHost: siteHost, after: error) else { return false }
        CAPLog.print("EAD: page failed to load, offline page shown: " + error.localizedDescription)
        webView.load(URLRequest(url: url))
        return true
    }
}
