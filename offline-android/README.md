# GhazBadloon Offline Android app

This is a separate, standalone offline application. It does not load the online Firebase app and does not call a remote API.

## Included functions
- Create, edit and delete employee records.
- Save monthly base salary and recurring allowance per employee.
- Calculate monthly gross pay, tax on base salary plus all allowances, extra deductions and net pay.
- Requested tax brackets: gross total up to AFN 10,000 is exempt; AFN 10,001 through 100,000 is taxed at 10%; above AFN 100,000 is taxed at 15%.
- Convert Solar Hijri, Umm al-Qura Lunar Hijri and Gregorian dates.
- Export and restore a local JSON backup.
- Export payroll history as CSV and print the current view.

## Offline data
All records are stored in this app's local Android WebView storage. They are not synchronized to another phone. Export a backup before uninstalling the app, clearing app data, or changing devices.

The Lunar Hijri result uses the Umm al-Qura calendar and can differ by one day from local moon-sighting announcements.

## Android package
com.hafzaywb553.ghazbadloon.offline

The GitHub Actions workflow builds, signs, verifies and publishes a directly installable debug APK.
