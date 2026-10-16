import { describe, expect, it } from 'vitest';
import { isJava } from './graph';
import { code, javaEdges, javaImports, packageOf } from './java';

const root = 'shop/src/main/java/com/shop';
const files = new Map([
  [`${root}/api/OrderController.java`, `package com.shop.api;

import com.shop.domain.Order;
import com.shop.domain.*;
import static com.shop.store.Db.connect;
import java.util.List;

/** Uses a Basket, and says "Invoice" in a string. */
public class OrderController {
  // a Refund in a comment isn't a use
  private final OrderService service = new OrderService();
  List<Order> list() { connect(); return service.all(Basket.EMPTY, "Invoice"); }
}`],
  [`${root}/api/OrderService.java`, 'package com.shop.api;\npublic class OrderService { java.util.List<Object> all(Object b, String s) { return null; } }'],
  [`${root}/domain/Order.java`, 'package com.shop.domain;\npublic class Order { public static class Line {} }'],
  [`${root}/domain/Basket.java`, 'package com.shop.domain;\npublic class Basket { public static final Basket EMPTY = new Basket(); }'],
  [`${root}/domain/Invoice.java`, 'package com.shop.domain;\npublic class Invoice {}'],
  [`${root}/domain/Refund.java`, 'package com.shop.domain;\npublic class Refund {}'],
  [`${root}/store/Db.java`, 'package com.shop.store;\nimport com.shop.domain.Order.Line;\npublic class Db { public static void connect() {} Line line; }'],
]);

const edges = () => javaEdges(files).map((e) => `${e.from.replace(`${root}/`, '')} > ${e.to.replace(`${root}/`, '')} [${e.names.join(',')}]`);

describe('reading a Java file', () => {
  it('finds its package and imports, ignoring comments and strings', () => {
    const src = code(files.get(`${root}/api/OrderController.java`) ?? '');
    expect(packageOf(src)).toBe('com.shop.api');
    expect(javaImports(src)).toEqual([
      { name: 'com.shop.domain.Order', isStatic: false, wildcard: false },
      { name: 'com.shop.domain', isStatic: false, wildcard: true },
      { name: 'com.shop.store.Db.connect', isStatic: true, wildcard: false },
      { name: 'java.util.List', isStatic: false, wildcard: false },
    ]);
    expect(src).not.toContain('Refund');
    expect(src).not.toContain('"Invoice"');
    expect(code('String s = "a // b"; int x; // gone')).toBe('String s = ""; int x;  ');
  });

  it('reads only main source, not tests', () => {
    expect(isJava('shop/src/main/java/com/shop/api/OrderController.java')).toBe(true);
    expect(isJava('shop/src/test/java/com/shop/api/OrderControllerTest.java')).toBe(false);
    expect(isJava('lib/OrderIT.java')).toBe(false);
    expect(isJava('lib/Order.kt')).toBe(false);
  });
});

describe('javaEdges', () => {
  it('leads each import to its class, a wildcard to the classes the file names, a static import to its class, and a nested class to the file it\'s in', () => {
    expect(edges()).toEqual([
      // Order by name; Basket through the wildcard; not Invoice (only in a string) nor Refund (only in a comment)
      'api/OrderController.java > domain/Order.java [Order]',
      'api/OrderController.java > domain/Basket.java [Basket]',
      'api/OrderController.java > store/Db.java [connect]',
      // its own package's classes, named without an import
      'api/OrderController.java > api/OrderService.java [OrderService]',
      'store/Db.java > domain/Order.java [Line]',
    ]);
  });

  it('finds a class wherever its source root is, and leaves out what isn\'t in the repo', () => {
    const two = new Map([
      ['app/src/main/java/a/App.java', 'package a;\nimport b.Lib;\nimport org.slf4j.Logger;\nclass App { Lib lib; }'],
      ['lib/src/b/Lib.java', 'package b;\npublic class Lib {}'],
    ]);
    expect(javaEdges(two)).toEqual([{ from: 'app/src/main/java/a/App.java', to: 'lib/src/b/Lib.java', names: ['Lib'] }]);
  });
});
