// No mocking needed — createForUser(user) is pure given a {id, role} input.
// Assertion-only scaffolding (still left for Boris to fill in, per
// CLAUDE.md, since CaslAbilityFactory was written this session):
//   const factory = new CaslAbilityFactory();
//   const ability = factory.createForUser({ id: 'user-1', role: 'manager' });
describe('CaslAbilityFactory', () => {
  describe('manager', () => {
    it.todo(
      'can manage (create/read/update/delete) Category, Product, and Sku',
    );
  });

  describe('client', () => {
    it.todo('can read Category, Product, and Sku');

    it.todo('cannot create, update, or delete Category, Product, or Sku');
  });
});
