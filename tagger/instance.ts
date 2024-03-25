import * as model from "./model.ts";
import {FieldVisitorI, Field, ScalarFieldBase, BooleanField, IntegerField, FloatField,
        StringField, IdField, PrimaryKeyField, RelationField, Schema} from "./model.ts";
import {unwrap, panic} from "../utils/utils.ts";
import * as utils from "../utils/utils.ts";
import {dictSchemaJson} from "./entry-schema.ts";
import { Assertion, getAssertionPath, selectAssertionsForTopLevelFact } from "./schema.ts";
import * as timestamp from "../utils/timestamp.ts";
import {assert} from '../utils/utils.ts';

export type Tag = string;

// - Get working first, then refactor.
// - write simple test stuff, probably also beaters, round trip MMO etc.
// - make API be nice.
// - figure out (client side) id allocator.  Also needs to support distributed
//   operation.   maybe add a nanoid to every fact.  Or pool of reserved ids for
//   remote - but hard to do with partitioning (can use a rename pass instead?)

// TODO 

// Perhaps the versioned relation tree should be forced??

// /**
//  *
//  */
// export class VersionedRelationContainer {
//     readonly schema: RelationField;
//     readonly childRelations: Record<Tag,VersionedRelation>;

//     constructor(schema: RelationField) {
//         this.schema = schema;
//         this.childRelations = Object.fromEntries(
//             schema.relationFields.map(r=>[r.tag, new VersionedRelation(r, this)]));
//     }

// }


interface Entry0 {
    name: string;
    
    spellings: {
        text: string;
        variant: string;
    }[],

    subentry: {
        part_of_speech: string;
        definition: {
            definition: string;
        }[];
        gloss: {
            gloss: string;
        }[];
    }[],
}

/*
  - would like typed access to the tree, including rich apis (meaning that
  we don't want to have the typed access by doing a copy of the tree).
  - don't want to use proxies
  - can take advantage of the relative immutability.
  - the shape below is wrong anyway for a multi-versioned tree.
  - 
 */

// Maybe variant is universal?  --- PROBABLY!  --- CAN JUST BURY EVERYWHERE THEN!
// interface VariantTupleVerisonT extends TupleVersionT {
//     variant: string;
// }

// How does root work?
// - the mode-consistent way would be to have a root tuple id (for example 0),
//   and then normal model would work from there.
// - there would be versioned data for this root tuple.
// - the type and id would be fixed (by the schema).
// - we could just forbid tuples at this level (and have an empty tuple
//   at the top) so that we can have a more consistent model.
// - problem is with lifetimes, which we need to figure out in general.
// - specifically, we have decoupled child lifetimes from parent tuple lifetimes,
//   but how do we handle children/decendants if the parent is deleted/not present.
// - from a user perspective, deleting the parent should delete the children - which
//   means the parent lifetime would effect the children.
// - this means that usual tree access will need to be parameterized by when.
// - anyway, this also means that if we want to have a unified root model,
//   we probably want to make a record for it.
// - not a bad thing to have for a dictionary anyway.
// - not super bad for export.
// - probably add to ty/id path thing just for consistency.


// - how does visibility work with a locale view?
// - if there is no tuple in the current locale, then we don't see children.



interface NodeT {
}

/**
 * 
 */
interface Node<TupleT> extends NodeT {
    $tuples: TupleT[];
}

/**
 *
 */
interface TupleVersionT {
    assertion_id: number;
    id: number;
    valid_from: number;
    valid_to: number;
}

interface DictionaryNode extends Node<Dictionary> {
    entry: EntryNode[];
}

interface Dictionary extends TupleVersionT {
}

interface EntryNode extends Node<Entry> {
    spelling: SpellingNode[];
    subentry: SubentryNode[];
}

interface Entry extends TupleVersionT {
}

interface SpellingNode extends Node<Spelling> {
}

interface Spelling extends TupleVersionT {
    text: string;
}

interface SubentryNode extends Node<Subentry> {
    definition: DefinitionNode[];
    //gloss: GlossNode[];
    // example: Example[];
    // recording: Recording[];
    // pronunication_guide: PronunciationGuide[];
    // category: Category[];
    // related_entry: RelatedEntry[];
    // alternate_grammatical_form: AlternateGrammaticalForm[];
    // other_regional_form: OtherRegionalForm[];
    // attr: Attr[];
}

interface Subentry extends TupleVersionT {
    part_of_speech: string;
}

interface DefinitionNode extends Node<Definition> {
    // ...
}

interface Definition extends TupleVersionT {
    definition: string;
}

interface Gloss extends TupleVersionT {
    gloss: string;
}

// interface Subentry extends Node {
//     part_of_speech: string;
//     definition: Definition[];
// }

// interface Definition extends Node {
//     definition: string;
// }


//let k: Entry.

// VersionedTuple can take a type parameter:
// -


// -------------------------------------------------------------------------------
// -------------------------------------------------------------------------------
// -------------------------------------------------------------------------------

/**
 *
 */
export class VersionedTuple/*<T extends NodeT>*/ {
    readonly id: number;
    readonly schema: RelationField;
    readonly tupleVersions: TupleVersion[] = [];
    readonly childRelations: Record<Tag,VersionedRelation>;
    #currentTuple: TupleVersion|undefined = undefined;

    constructor(schema: RelationField, id: number) {
        this.schema = schema;
        this.childRelations = Object.fromEntries(
            schema.relationFields.map(r=>[r.tag, new VersionedRelation(r, this)]));
        this.id = id;
    }

    applyAssertionByPath(path: [string, number][], assertion: Assertion, index: number=0) {
        const versionedTuple = this.getVersionedTupleByPath(path);
        versionedTuple.applyAssertion(assertion);
    }

    getVersionedTupleByPath(path: [string, number][], index: number=0): VersionedTuple {
        //console.info('PATH is', path, path[index], index, 'SELF is', this.schema.tag, 'child is', this.schema.relationFields.map(r=>r.tag), 'self type', utils.className(this));
        const [ty, id] = path[index];

        const versionedRelation = this.childRelations[ty];
        if(!versionedRelation) {
            throw new Error(`unexpected tag ${ty} -- FIX ERROR NEED LOCUS ETC`);
        }
        utils.assert(versionedRelation.schema.tag === ty);

        let versionedTuple = versionedRelation.tuples[id];
         if(!versionedTuple) {
            versionedTuple = new VersionedTuple(versionedRelation.schema, id);
            versionedRelation.tuples[id] = versionedTuple;
        }
        utils.assert(versionedTuple.schema.tag === ty);
        
        if(index+1 === path.length)
            return versionedTuple;
        else
            return versionedTuple.getVersionedTupleByPath(path, index+1);
    }

    forEachVersionedTuple(f: (r:VersionedTuple)=>void) {
        f(this);
        for(const v of Object.values(this.childRelations))
            v.forEachVersionedTuple(f);
    }

    findVersionedTuples(filter: (r:VersionedTuple)=>boolean): Array<VersionedTuple> {
        const collection: VersionedTuple[] = [];
        this.forEachVersionedTuple(t=>{
            if(filter(t))
                collection.push(t);
        });
        return collection;
    }

    findVersionedTupleById(id: number): VersionedTuple|undefined {
        let found: VersionedTuple|undefined;
        this.forEachVersionedTuple(t=>{
            if(t.id === id) {
                if(found !== undefined)
                    throw new Error(`multiple tuples found for id ${id}`);
                found = t;
            }
        });
        return found;
    }

    findRequiredVersionedTupleById(id: number): VersionedTuple {
        const tuple = this.findVersionedTupleById(id);
        if(tuple === undefined)
            throw new Error(`failed to find required versioned tuple for id ${id}`);
        return tuple;
    }
    
    applyAssertion(assertion: Assertion) {
        const tuple = new TupleVersion(this, assertion);
        // TODO lots of validation here + index updating etc.
        // TODO update current.
        // TODO tie into speculative mechanism.
        const mostRecentTuple = this.mostRecentTuple;
        if(mostRecentTuple) {
            if(mostRecentTuple.assertion.valid_to) {
                if(tuple.assertion.valid_from !== mostRecentTuple.assertion.valid_to) {
                    throw new Error(`FIX ERROR: valid_from chain broken`);
                }
            } else {
                // This is tricky - we should probably mute the valid_to on the previous
                //  most current tuple - but this complicates undo etc.  The fact that
                //  valid_to with a non-null value is also used for undo complicates things.
                if(mostRecentTuple.assertion.valid_from <= tuple.assertion.valid_from) {
                    throw new Error(`FIX ERROR: time travel prolbem`);
                }
            }
        }
        
        this.tupleVersions.push(tuple);
        if(tuple.isCurrent)
            this.#currentTuple = tuple;
    }

    get mostRecentTuple() {
        // Note: we are making use of the JS behaviour where out of bound index accesses return undefined.
        return this.tupleVersions[this.tupleVersions.length-1];
    }

    
    // forEachVersionedTuple(f: (r:VersionedTuple)=>void) {
    //     f(this);
    //     super.forEachVersionedTuple(f);
    // }

    dump(): any {
        return {
            //type: this.schema.name,
            //id: this.id,
            versions: this.tupleVersions.map(a=>a.dump()),
            ...Object.fromEntries(Object.values(this.childRelations).map(c=>
                [c.schema.name, c.dump()]))
        };
    }
}

/**
 *
 *
 * - need to handle views of the content based on time + variant
 * - ordering of view needs to also be time based.
 * - need to track local (uncommitted) insertions etc.
 */
export class VersionedRelation {
    readonly schema: RelationField;
    readonly parent: VersionedTuple;
    readonly tuples: Record<number,VersionedTuple> = {};

    constructor(schema: RelationField, parent: VersionedTuple) {
        this.schema = schema;
        this.parent = parent;
    }

    forEachVersionedTuple(f: (r:VersionedTuple)=>void) {
        for(const v of Object.values(this.tuples))
            v.forEachVersionedTuple(f);
    }

    dump(): any {
        return Object.fromEntries(Object.entries(this.tuples).map(([id, child])=>
            [id, child.dump()]));
    }
}

/**
 *
 */
export class TupleVersion {
    readonly relation: VersionedTuple;
    readonly assertion: Assertion;
    
    #domainFields: Record<string,any>|undefined = undefined;
    //#changeRegistrations

    constructor(relation: VersionedTuple, assertion: Assertion) {
        this.relation = relation;
        this.assertion = assertion;
    }

    get isCurrent(): boolean {
        return this.assertion.valid_to === timestamp.END_TIME;
    }
    
    get domainFields(): Record<string,any> {
        // TODO: consider checking type of domain fields.
        // TODO: fix the 'as any' below
        return this.#domainFields ??= Object.fromEntries(
            this.relation.schema.scalarFields.map(f=>[f.name, (this.assertion as any)[f.bind]]));
    }

    dump(): any {
        const a = this.assertion;
        return {
            ...(a.valid_from !== timestamp.BEGIN_TIME ?
                {valid_from: timestamp.formatTimestampAsUTCTime(a.valid_from)} : {}),
            ...(a.valid_to !== timestamp.END_TIME ?
                {valid_to: timestamp.formatTimestampAsUTCTime(a.valid_to)} : {}),
            //id: this.relation.id,
            //ty: this.relation.schema.tag,
            ...this.domainFields,
        };
    }
}

// /**
//  *
//  */
// export class VersionedDatabaseWorkspace extends VersionedRelationContainer {
//     declare schema: Schema;
    
//     //readonly factsById: Map<number, FactCollection> = new Map();
    
//     constructor(schema: Schema) {
//         super(schema);
//     }

//     apply(assertion: Assertion) {
//         // We want to be able to apply assertions at any depth, in any order.
//         // - Top level apply will lookup RelationField for ty (using index on schema),
//         //   and then traversal will walk/create nodes, then apply to fact.
//         // - top level is still a container even if we are only mirroring a single
//         //   record.
//         // const relationField = this.schema.relationsByTag[assertion.ty];
//         // if(!relationField)
//         //     throw new Error(`Failed to find relation with tag '${assertion.ty}' in schema ${this.schema.name}`);

//         return this.applyAssertionByPath(getAssertionPath(assertion), assertion);
//     }

//     dump(): any {
//         return Object.fromEntries(Object.entries(this.childRelations).map(([id, child])=>
//             [id, child.dump()]));
//     }

//     // dump(): any {
//     //     return Object.values(this.childRelations).map(child=>({
//     //         type: child.schema.name: child.dump()}));
//     // }
    
// }


function test() {
    const dictSchema = model.Schema.parseSchemaFromCompactJson('dict', dictSchemaJson);

    // --- Load the tuples for a dictionary entry.
    const sampleEntryAssertions = selectAssertionsForTopLevelFact('dict').all({id1:1000});
    //console.info('Sample entry assertions', sampleEntryAssertions);

    // --- Create an empty instance schema
    //const mmoDb = new VersionedDatabaseWorkspace(dictSchema);
    const mmoDb = new VersionedTuple/*<DictionaryNode>*/(dictSchema, 0);
    sampleEntryAssertions.forEach(a=>mmoDb.applyAssertionByPath(getAssertionPath(a), a));
    console.info(JSON.stringify(mmoDb.dump(), undefined, 2));

    const entries = mmoDb.childRelations['en'];
    //console.info('entries', entries);
    
    // --- Navigate to definition
    let definition = mmoDb.findRequiredVersionedTupleById(992);
    console.info('definition', definition.dump());

    // --- Edit definition
    //definition.applyAssertion();
    
    // --- Add a second pronunciation guide

    // --- Persist this to disk!
    
    //fieldToFieldInstInst.accept(dictSchema);
}





if (import.meta.main)
    await test();
