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
        let filter = NavigationFilter(target: capacitorDelegate)
        navigationFilter = filter
        webView.navigationDelegate = filter
    }
}

/// Stands between the web view and Capacitor's own navigation delegate, which
/// shows the offline page (server.errorPath) for any load that fails. A load
/// that was only interrupted is not a lost connection: one page replaced by
/// another before it arrived, or a file the web view cannot show. Everything
/// else goes to Capacitor unchanged.
final class NavigationFilter: NSObject, WKNavigationDelegate {
    /// Capacitor's WebViewDelegationHandler, kept alive by the bridge.
    private weak var target: WKNavigationDelegate?

    init(target: WKNavigationDelegate) {
        self.target = target
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

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if NavigationFilter.isInterruption(error) { return }
        target?.webView?(webView, didFailProvisionalNavigation: navigation, withError: error)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        if NavigationFilter.isInterruption(error) { return }
        target?.webView?(webView, didFail: navigation, withError: error)
    }

    static func isInterruption(_ error: Error) -> Bool {
        let error = error as NSError
        if error.domain == NSURLErrorDomain && error.code == NSURLErrorCancelled { return true }
        // WebKitErrorFrameLoadInterruptedByPolicyChange: a download, or a
        // file type the web view does not display.
        return error.domain == "WebKitErrorDomain" && error.code == 102
    }
}
