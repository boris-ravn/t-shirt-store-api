export function mockTransactionPassthrough<
  T extends { $transaction: jest.Mock },
>(prisma: T): void {
  prisma.$transaction.mockImplementation((callback: (tx: T) => unknown) =>
    callback(prisma),
  );
}
