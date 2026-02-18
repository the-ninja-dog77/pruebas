import 'package:flutter_test/flutter_test.dart';
import 'package:barber_admin_app/main.dart';

void main() {
  testWidgets('App loads without crashing', (WidgetTester tester) async {
    await tester.pumpWidget(const BarberAdminApp());
    expect(find.text('ZZETA BARBER CLUB'), findsOneWidget);
  });
}
